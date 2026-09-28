import { Aws, CfnOutput, RemovalPolicy, Validations } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  PriceClass,
  ViewerProtocolPolicy,
  type BehaviorOptions,
} from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { SITE_BUCKET_PREFIX } from './config';
import type { LoadBalancer } from './load-balancer';

/** Named by account, so the demo role can be granted this bucket alone; demo-up syncs the pages in. */
function createSiteBucket(scope: Construct): Bucket {
  const bucket = new Bucket(scope, 'SiteBucket', {
    bucketName: `${SITE_BUCKET_PREFIX}${Aws.ACCOUNT_ID}`,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    encryption: BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    removalPolicy: RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
  });
  Validations.of(bucket).acknowledge({
    id: 'AwsSolutions-S1',
    reason:
      'Holds only public static site files and is deleted with the stack; access logs would need a second bucket.',
  });
  return bucket;
}

const DISTRIBUTION_ACKNOWLEDGEMENTS: Record<string, string> = {
  'AwsSolutions-CFR1': 'Callers are not restricted by country in this demo.',
  'AwsSolutions-CFR2':
    'WAF is out of scope for the demo; the access code gates WebSocket connects.',
  'AwsSolutions-CFR3':
    'Short-lived demo distribution; the host records per-session traces instead of access logs.',
  'AwsSolutions-CFR4':
    'The free cloudfront.net domain uses the default certificate, which fixes the minimum TLS version.',
  'AwsSolutions-CFR5':
    'No custom domain, so the ALB has no certificate; only CloudFront prefix-list traffic can reach it over HTTP.',
};

function passThroughToAlb(lb: LoadBalancer): BehaviorOptions {
  return {
    origin: new LoadBalancerV2Origin(lb.alb, { protocolPolicy: OriginProtocolPolicy.HTTP_ONLY }),
    viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
    allowedMethods: AllowedMethods.ALLOW_ALL,
    cachePolicy: CachePolicy.CACHING_DISABLED,
    originRequestPolicy: OriginRequestPolicy.ALL_VIEWER,
  };
}

/** HTTPS front door: the S3 site by default, `/ws` and `/api/*` passed through to the ALB. */
export function createSite(scope: Construct, lb: LoadBalancer): Distribution {
  const bucket = createSiteBucket(scope);
  const distribution = new Distribution(scope, 'Distribution', {
    defaultRootObject: 'index.html',
    priceClass: PriceClass.PRICE_CLASS_100,
    defaultBehavior: {
      origin: S3BucketOrigin.withOriginAccessControl(bucket),
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    },
    additionalBehaviors: { '/ws': passThroughToAlb(lb), '/api/*': passThroughToAlb(lb) },
  });
  for (const [id, reason] of Object.entries(DISTRIBUTION_ACKNOWLEDGEMENTS)) {
    Validations.of(distribution).acknowledge({ id, reason });
  }
  new CfnOutput(scope, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
  new CfnOutput(scope, 'SiteBucketName', { value: bucket.bucketName });
  return distribution;
}
