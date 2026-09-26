import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AppStack } from './app-stack';

const EXPIRES_AT = '2026-09-26T18:30:00Z';

function build(props: { expiresAt?: string } = { expiresAt: EXPIRES_AT }) {
  const stack = new AppStack(new App(), 'TestApp', {
    expiresAt: props.expiresAt,
    imageTag: 'test',
  });
  return { stack, template: Template.fromStack(stack) };
}

describe('AppStack tags', () => {
  it('refuses to build without a valid ExpiresAt', () => {
    expect(() => build({})).toThrow(/ExpiresAt/);
    expect(() => build({ expiresAt: 'soon' })).toThrow(/ExpiresAt/);
  });

  it('tags the stack with ExpiresAt and supplier-line:ephemeral', () => {
    const { stack } = build();
    expect(stack.tags.tagValues()).toMatchObject({
      ExpiresAt: EXPIRES_AT,
      'supplier-line:ephemeral': 'true',
    });
  });
});

describe('AppStack network', () => {
  it('has public subnets only and no NAT gateway', () => {
    const { template } = build();
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
    template.resourceCountIs('AWS::EC2::Subnet', 2);
    template.allResourcesProperties('AWS::EC2::Subnet', { MapPublicIpOnLaunch: true });
  });

  it('tags the resources it creates', () => {
    const { template } = build();
    template.hasResourceProperties('AWS::EC2::VPC', {
      Tags: [
        { Key: 'ExpiresAt', Value: EXPIRES_AT },
        Match.objectLike({ Key: 'Name' }),
        { Key: 'supplier-line:ephemeral', Value: 'true' },
      ],
    });
  });
});

describe('AppStack load balancer', () => {
  it('is internet-facing with a 300 s idle timeout', () => {
    const { template } = build();
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      LoadBalancerAttributes: Match.arrayWith([
        { Key: 'idle_timeout.timeout_seconds', Value: '300' },
      ]),
    });
  });

  it('admits only the CloudFront prefix list, resolved at deploy time', () => {
    const { template } = build();
    template.hasResourceProperties('Custom::AWS', {
      Create: Match.stringLikeRegexp('com.amazonaws.global.cloudfront.origin-facing'),
    });
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      SourcePrefixListId: Match.anyValue(),
      IpProtocol: 'tcp',
      FromPort: 80,
      ToPort: 80,
    });
    const ingress = [
      ...Object.values(template.findResources('AWS::EC2::SecurityGroup')).flatMap(
        (sg) => sg.Properties.SecurityGroupIngress ?? []
      ),
      ...Object.values(template.findResources('AWS::EC2::SecurityGroupIngress')).map(
        (r) => r.Properties
      ),
    ];
    expect(ingress.filter((rule) => rule.CidrIp)).toEqual([]);
  });
});

describe('AppStack service', () => {
  it('runs one ARM64 Fargate task of 0.5 vCPU and 1 GB with a public IP', () => {
    const { template } = build();
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '512',
      Memory: '1024',
      RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
    });
    template.hasResourceProperties('AWS::ECS::Service', {
      LaunchType: 'FARGATE',
      DesiredCount: 1,
      NetworkConfiguration: {
        AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'ENABLED' }),
      },
    });
  });

  it('is registered behind the load balancer on the host port', () => {
    const { template } = build();
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Port: 8080,
      TargetType: 'ip',
      HealthCheckPath: '/health',
    });
  });

  it('lets the task role call Nova 2 Sonic and nothing wider on Bedrock', () => {
    const { template } = build();
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'bedrock:InvokeModelWithBidirectionalStream',
            Resource: Match.objectLike({
              'Fn::Join': Match.arrayWith([
                Match.arrayWith([Match.stringLikeRegexp('amazon.nova-2-sonic-v1:0')]),
              ]),
            }),
          }),
        ]),
      },
    });
  });

  it('lets the task write traces to the persistent traces bucket', () => {
    const { template } = build();
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 's3:PutObject',
            Resource: Match.objectLike({
              'Fn::Join': Match.arrayWith([
                Match.arrayWith([Match.stringLikeRegexp('supplier-line-traces-')]),
              ]),
            }),
          }),
        ]),
      },
    });
  });
});

describe('AppStack CloudFront', () => {
  it('keeps the site bucket private and deletable with the stack', () => {
    const { template } = build();
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Delete' });
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  it('serves the site from S3 and routes /ws and /api/* to the ALB', () => {
    const { template } = build();
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
        CacheBehaviors: [
          Match.objectLike({ PathPattern: '/ws', ViewerProtocolPolicy: 'https-only' }),
          Match.objectLike({ PathPattern: '/api/*', ViewerProtocolPolicy: 'https-only' }),
        ],
        Origins: Match.arrayWith([
          Match.objectLike({
            CustomOriginConfig: Match.objectLike({ OriginProtocolPolicy: 'http-only' }),
          }),
        ]),
      }),
    });
  });

  it('exports the site URL and bucket name for demo-up', () => {
    const { template } = build();
    expect(Object.keys(template.findOutputs('*'))).toEqual(
      expect.arrayContaining(['SiteUrl', 'SiteBucketName'])
    );
  });
});

describe('AppStack synth', () => {
  it('needs no context lookups even with a concrete account and region', () => {
    const app = new App();
    new AppStack(app, 'Concrete', {
      env: { account: '123456789012', region: 'us-east-1' },
      expiresAt: EXPIRES_AT,
      imageTag: 'test',
    });
    expect(app.synth().manifest.missing ?? []).toEqual([]);
  });
});
