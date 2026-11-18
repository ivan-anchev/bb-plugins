import test from 'node:test';
test('QA A2 deliberate CI failure', () => { throw new Error('QA_A2_INTENTIONAL_CI_FAILURE'); });
