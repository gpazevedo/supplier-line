import { createHash } from 'node:crypto';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { CfnBot, CfnBotAlias, CfnBotVersion } from 'aws-cdk-lib/aws-lex';
import { Validations } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

const LOCALE_ID = 'en_US';
export const PO_INTENT = 'PoStatus';
export const PO_SLOT = 'PoDigits';

const plainText = (value: string) => ({
  messageGroupsList: [{ message: { plainTextMessage: { value } } }],
  maxRetries: 2,
  allowInterrupt: true,
});

const poStatusIntent: CfnBot.IntentProperty = {
  name: PO_INTENT,
  description: 'Status of a purchase order, looked up by the PO status Lambda.',
  sampleUtterances: [
    'What is the status of P O {PoDigits}',
    'What is the status of purchase order {PoDigits}',
    'Where is P O {PoDigits}',
    'Check P O {PoDigits}',
    'P O {PoDigits}',
    'I want to check a purchase order',
    'Purchase order status',
  ].map((utterance) => ({ utterance })),
  slots: [
    {
      name: PO_SLOT,
      slotTypeName: 'PoDigitsType',
      valueElicitationSetting: {
        slotConstraint: 'Required',
        promptSpecification: plainText('What are the five digits of the P O number?'),
      },
    },
  ],
  slotPriorities: [{ priority: 1, slotName: PO_SLOT }],
  fulfillmentCodeHook: { enabled: true },
};

const locale: CfnBot.BotLocaleProperty = {
  localeId: LOCALE_ID,
  nluConfidenceThreshold: 0.4,
  voiceSettings: { voiceId: 'Matthew', engine: 'neural' },
  slotTypes: [
    {
      name: 'PoDigitsType',
      description: 'The five digits after "PO", e.g. 10482.',
      parentSlotTypeSignature: 'AMAZON.AlphaNumeric',
      valueSelectionSetting: {
        resolutionStrategy: 'ORIGINAL_VALUE',
        regexFilter: { pattern: '[0-9]{5}' },
      },
    },
  ],
  intents: [
    poStatusIntent,
    { name: 'FallbackIntent', parentIntentSignature: 'AMAZON.FallbackIntent' },
  ],
};

/** The Lex V2 service role; Lex needs Polly for its text-to-speech prompts. */
function createBotRole(scope: Construct): Role {
  const role = new Role(scope, 'BotRole', {
    assumedBy: new ServicePrincipal('lexv2.amazonaws.com'),
  });
  role.addToPolicy(new PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }));
  Validations.of(role).acknowledge({
    id: 'AwsSolutions-IAM5[Resource::*]',
    reason: 'polly:SynthesizeSpeech has no resource-level permissions.',
  });
  return role;
}

/**
 * Lex V2 bot (en_US) with the PoStatus intent and its PoDigits slot, fulfilled by `fulfillment`
 * through the `live` alias. A new version is cut whenever the locale definition changes.
 */
export function createLexBot(scope: Construct, fulfillment: IFunction): CfnBotAlias {
  const bot = new CfnBot(scope, 'Bot', {
    name: 'supplier-line-po-status',
    roleArn: createBotRole(scope).roleArn,
    dataPrivacy: { ChildDirected: false },
    idleSessionTtlInSeconds: 300,
    autoBuildBotLocales: true,
    botLocales: [locale],
  });
  const hash = createHash('sha256').update(JSON.stringify(locale)).digest('hex').slice(0, 8);
  const version = new CfnBotVersion(scope, `BotVersion${hash}`, {
    botId: bot.attrId,
    botVersionLocaleSpecification: [
      { localeId: LOCALE_ID, botVersionLocaleDetails: { sourceBotVersion: 'DRAFT' } },
    ],
  });
  return new CfnBotAlias(scope, 'BotAlias', {
    botId: bot.attrId,
    botAliasName: 'live',
    botVersion: version.attrBotVersion,
    botAliasLocaleSettings: [
      {
        localeId: LOCALE_ID,
        botAliasLocaleSetting: {
          enabled: true,
          codeHookSpecification: {
            lambdaCodeHook: { lambdaArn: fulfillment.functionArn, codeHookInterfaceVersion: '1.0' },
          },
        },
      },
    ],
  });
}
