export const GREETING = 'Hi, this is Supplier Line. Which purchase order can I help you with?';
export const ERROR_MESSAGE =
  'Sorry, something went wrong on our side. Please try again later. Goodbye.';

const onError = (next: string, ...types: string[]) =>
  types.map((ErrorType) => ({ NextAction: next, ErrorType }));

/**
 * Flow-language content: set the voice to Matthew, hand the caller to the Lex bot, then disconnect.
 * Any error, or the caller going silent, takes the error branch, which plays ERROR_MESSAGE.
 */
export function contactFlowContent(botAliasArn: string) {
  return {
    Version: '2019-10-30',
    StartAction: 'set-voice',
    Actions: [
      {
        Identifier: 'set-voice',
        Type: 'UpdateContactTextToSpeechVoice',
        Parameters: { TextToSpeechVoice: 'Matthew' },
        Transitions: { NextAction: 'po-bot', Errors: onError('error-message', 'NoMatchingError') },
      },
      {
        Identifier: 'po-bot',
        Type: 'ConnectParticipantWithLexBot',
        Parameters: { Text: GREETING, LexV2Bot: { AliasArn: botAliasArn } },
        Transitions: {
          NextAction: 'disconnect',
          Errors: [
            ...onError('disconnect', 'NoMatchingCondition'),
            ...onError('error-message', 'NoMatchingError', 'InputTimeLimitExceeded'),
          ],
        },
      },
      {
        Identifier: 'error-message',
        Type: 'MessageParticipant',
        Parameters: { Text: ERROR_MESSAGE },
        Transitions: { NextAction: 'disconnect', Errors: onError('disconnect', 'NoMatchingError') },
      },
      { Identifier: 'disconnect', Type: 'DisconnectParticipant', Parameters: {}, Transitions: {} },
    ],
  };
}
