import { Aws, Stack } from 'aws-cdk-lib';
import { CfnContactFlow, CfnInstance, CfnIntegrationAssociation } from 'aws-cdk-lib/aws-connect';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';
import { contactFlowContent } from './contact-flow';
import { createLexBot } from './lex-bot';

export interface ConnectFrontDoor {
  instance: CfnInstance;
  flow: CfnContactFlow;
}

/**
 * Amazon Connect instance with the Lex bot associated and a contact flow that uses it.
 * The bot's Sonic speech-to-speech setting stays manual (V-09).
 */
export function createConnect(scope: Construct, fulfillment: IFunction): ConnectFrontDoor {
  const instance = new CfnInstance(scope, 'ConnectInstance', {
    identityManagementType: 'CONNECT_MANAGED',
    instanceAlias: `supplier-line-${Aws.ACCOUNT_ID}`,
    attributes: { inboundCalls: true, outboundCalls: false, contactflowLogs: true },
  });
  const alias = createLexBot(scope, fulfillment);
  fulfillment.addPermission('LexInvoke', {
    principal: new ServicePrincipal('lexv2.amazonaws.com'),
    sourceArn: alias.attrArn,
  });
  const association = new CfnIntegrationAssociation(scope, 'BotAssociation', {
    instanceId: instance.attrArn,
    integrationType: 'LEX_BOT',
    integrationArn: alias.attrArn,
  });
  const flow = new CfnContactFlow(scope, 'ContactFlow', {
    instanceArn: instance.attrArn,
    name: 'supplier-line-po-status',
    type: 'CONTACT_FLOW',
    content: Stack.of(scope).toJsonString(contactFlowContent(alias.attrArn)),
  });
  flow.addResourceDependency(association);
  return { instance, flow };
}
