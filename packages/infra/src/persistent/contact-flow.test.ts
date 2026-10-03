import { describe, expect, it } from 'vitest';
import { contactFlowContent } from './contact-flow';

type Flow = ReturnType<typeof contactFlowContent>;
type Action = Flow['Actions'][number];

const targets = (a: Action): string[] =>
  [a.Transitions.NextAction, ...(a.Transitions.Errors ?? []).map((e) => e.NextAction)].filter(
    (t): t is string => Boolean(t)
  );

function reachableFrom(flow: Flow): Set<string> {
  const byId = new Map<string, Action>(flow.Actions.map((a) => [a.Identifier, a]));
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const action = byId.get(id);
    if (action) targets(action).forEach(visit);
  };
  visit(flow.StartAction);
  return seen;
}

describe('contact flow graph', () => {
  const flow = contactFlowContent('ARN');
  const ids = new Set(flow.Actions.map((a) => a.Identifier));
  const byId = new Map<string, Action>(flow.Actions.map((a) => [a.Identifier, a]));

  it('starts at an existing action', () => {
    expect(ids.has(flow.StartAction)).toBe(true);
  });

  it('resolves every NextAction and error target', () => {
    for (const a of flow.Actions) {
      for (const t of targets(a)) expect(ids, `${a.Identifier} -> ${t}`).toContain(t);
    }
  });

  it('reaches every action from the start', () => {
    expect([...reachableFrom(flow)].sort()).toEqual([...ids].sort());
  });

  it('ends every path in DisconnectParticipant', () => {
    for (const a of flow.Actions) {
      if (a.Type === 'DisconnectParticipant') continue;
      expect(targets(a).length, a.Identifier).toBeGreaterThan(0);
    }
    expect(byId.get('disconnect')?.Type).toBe('DisconnectParticipant');
  });

  it('sends po-bot timeout and no-match errors to error-message', () => {
    const errors = byId.get('po-bot')?.Transitions.Errors ?? [];
    for (const type of ['NoMatchingError', 'InputTimeLimitExceeded']) {
      expect(errors.find((e) => e.ErrorType === type)?.NextAction).toBe('error-message');
    }
  });
});
