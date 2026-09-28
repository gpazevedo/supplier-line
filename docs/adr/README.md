# Architecture decision records

Short records of decisions worth remembering later, each with context, the decision, consequences
and evidence links back to the code, a test, or a committed trace.

| ADR                                               | Decision                                           |
| ------------------------------------------------- | -------------------------------------------------- |
| [0001](0001-english-only.md)                      | English (en-US) only                               |
| [0002](0002-access-code-over-cognito.md)          | A shared access code instead of Cognito            |
| [0003](0003-model-detected-barge-in.md)           | Barge-in is model-detected only                    |
| [0004](0004-two-cdk-stacks.md)                    | Two CDK stacks: persistent and app                 |
| [0005](0005-consent-gated-deploys.md)             | Consent-gated deploys, with independent layers     |
| [0006](0006-digit-codes-and-early-lookup-hold.md) | Digit-by-digit PO codes, and the early-lookup hold |
| [0007](0007-rotation-names-last-order.md)         | A rotation handover names the last order found     |
| [0008](0008-due-and-expected-dates.md)            | Speak both the due date and the expected date      |
