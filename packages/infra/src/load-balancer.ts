import { Duration, Validations } from 'aws-cdk-lib';
import { type IVpc, Port, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import {
  ApplicationListener,
  ApplicationLoadBalancer,
  ApplicationProtocol,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import type { Construct } from 'constructs';
import { cloudFrontOrigins } from './cloudfront-prefix-list';

export interface LoadBalancer {
  alb: ApplicationLoadBalancer;
  listener: ApplicationListener;
}

/** Internet-facing ALB that only CloudFront can reach; the 300 s idle timeout keeps quiet WebSockets open. */
export function createLoadBalancer(scope: Construct, vpc: IVpc): LoadBalancer {
  const securityGroup = new SecurityGroup(scope, 'AlbSecurityGroup', {
    vpc,
    description: 'Load balancer: HTTP from CloudFront only',
    allowAllOutbound: false,
  });
  securityGroup.addIngressRule(cloudFrontOrigins(scope), Port.tcp(80), 'CloudFront origin-facing');
  const alb = new ApplicationLoadBalancer(scope, 'Alb', {
    vpc,
    internetFacing: true,
    securityGroup,
    idleTimeout: Duration.seconds(300),
    dropInvalidHeaderFields: true,
  });
  Validations.of(alb).acknowledge({
    id: 'AwsSolutions-ELB2',
    reason:
      'Short-lived demo ALB; per-session traces are recorded by the host, so access logs add nothing.',
  });
  const listener = alb.addListener('Http', { protocol: ApplicationProtocol.HTTP, open: false });
  return { alb, listener };
}
