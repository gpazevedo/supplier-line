import { Validations } from 'aws-cdk-lib';
import { PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { AwsCustomResource, AwsCustomResourcePolicy } from 'aws-cdk-lib/custom-resources';
import { Peer, type IPeer } from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';

const PREFIX_LIST_NAME = 'com.amazonaws.global.cloudfront.origin-facing';

/** Peer for CloudFront's origin-facing IPs. The list ID is looked up at deploy time, so synth needs no credentials. */
export function cloudFrontOrigins(scope: Construct): IPeer {
  const lookup = new AwsCustomResource(scope, 'CloudFrontPrefixList', {
    onUpdate: {
      service: 'EC2',
      action: 'describeManagedPrefixLists',
      parameters: { Filters: [{ Name: 'prefix-list-name', Values: [PREFIX_LIST_NAME] }] },
      physicalResourceId: PhysicalResourceId.of(PREFIX_LIST_NAME),
    },
    policy: AwsCustomResourcePolicy.fromSdkCalls({
      resources: AwsCustomResourcePolicy.ANY_RESOURCE,
    }),
    installLatestAwsSdk: false,
  });
  Validations.of(lookup).acknowledge({
    id: 'AwsSolutions-IAM5[Resource::*]',
    reason:
      'ec2:DescribeManagedPrefixLists is a read-only List action and does not support resource-level permissions.',
  });
  return Peer.prefixList(lookup.getResponseField('PrefixLists.0.PrefixListId'));
}
