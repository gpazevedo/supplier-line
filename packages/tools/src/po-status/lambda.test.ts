import type { LexV2Event, LexV2Result } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { lexFulfillment } from './lambda';

/** A Lex V2 fulfillment event for the PoStatus intent, as Connect sends it. */
function lexEvent(digits: string | null): LexV2Event {
  return {
    messageVersion: '1.0',
    invocationSource: 'FulfillmentCodeHook',
    inputMode: 'Speech',
    responseContentType: 'text/plain; charset=utf-8',
    sessionId: '1234567890123',
    inputTranscript: 'the status of P O one zero four eight two',
    bot: {
      id: 'BOTID12345',
      name: 'SupplierLine',
      aliasId: 'TSTALIASID',
      aliasName: 'TestBotAlias',
      localeId: 'en_US',
      version: 'DRAFT',
    },
    interpretations: [],
    proposedNextState: {
      dialogAction: { type: 'Delegate' },
      intent: {
        name: 'PoStatus',
        state: 'ReadyForFulfillment',
        confirmationState: 'None',
        slots: {},
      },
    },
    transcriptions: [],
    sessionState: {
      originatingRequestId: 'req-1',
      sessionAttributes: { channel: 'connect' },
      intent: {
        name: 'PoStatus',
        state: 'ReadyForFulfillment',
        confirmationState: 'None',
        slots: {
          PoDigits: digits
            ? {
                shape: 'Scalar',
                value: {
                  originalValue: digits,
                  interpretedValue: digits,
                  resolvedValues: [digits],
                },
              }
            : null,
        },
      },
    },
  };
}

const messageText = (r: LexV2Result) => (r.messages?.[0] as { content: string }).content;

function expectClosed(result: LexV2Result, state: string, content: string) {
  expect(result.sessionState.dialogAction).toEqual({ type: 'Close' });
  expect(result.sessionState.intent).toMatchObject({ name: 'PoStatus', state });
  expect(result.sessionState.sessionAttributes).toEqual({ channel: 'connect' });
  expect(result.messages).toEqual([{ contentType: 'PlainText', content }]);
}

describe('Lex V2 fulfillment Lambda', () => {
  it('answers a spoken PO code with the rendering as the message', async () => {
    const result = await lexFulfillment(lexEvent('one zero four eight two'));
    expectClosed(
      result,
      'Fulfilled',
      'Purchase order P O dash one zero four eight two from Summit Fasteners has shipped. ' +
        'The amount is forty-five thousand two hundred sixteen euros and eighteen cents. ' +
        'It was ordered on October fourth, twenty twenty-six, ' +
        'and delivery is due on October twenty-fourth, twenty twenty-six.'
    );
  });

  it('accepts digits as transcribed', async () => {
    const result = await lexFulfillment(lexEvent('20931'));
    expect(messageText(result)).toMatch(/^Purchase order P O dash two zero nine three one /);
  });

  it('fails the intent with the apology for an unknown code', async () => {
    const result = await lexFulfillment(lexEvent('00003'));
    expectClosed(
      result,
      'Failed',
      "Sorry, I couldn't find purchase order P O dash zero zero zero zero three. " +
        'Could you check the number and say it again?'
    );
  });

  it('fails the intent with invalid_code when the slot is empty', async () => {
    const result = await lexFulfillment(lexEvent(null));
    expect(result.sessionState.intent?.state).toBe('Failed');
    expect(messageText(result)).toMatch(/^Sorry, I didn't catch a purchase order code/);
  });
});
