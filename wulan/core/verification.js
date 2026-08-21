// Wulan verification layer: separates "tool ran" from "task was actually solved".
export const VERIFICATION_OUTCOMES = Object.freeze({
  VERIFIED: 'verified',
  FAILED: 'failed',
  INCONCLUSIVE: 'inconclusive',
});

export function verifyCapabilityResult({ capability, result, expected = null } = {}) {
  if (!capability) return { outcome: VERIFICATION_OUTCOMES.INCONCLUSIVE, confidence: 0, reason: 'CAPABILITY_MISSING' };
  if (result == null) return { outcome: VERIFICATION_OUTCOMES.FAILED, confidence: 1, reason: 'EMPTY_RESULT' };

  if (typeof capability.verify === 'function') {
    try {
      const verdict = capability.verify(result, expected);
      if (verdict?.outcome) return {
        outcome: verdict.outcome,
        confidence: Math.max(0, Math.min(1, Number(verdict.confidence ?? .8))),
        reason: verdict.reason ?? 'CAPABILITY_VERIFIER',
        evidence: verdict.evidence ?? null,
      };
    } catch (error) {
      return { outcome: VERIFICATION_OUTCOMES.INCONCLUSIVE, confidence: 0, reason: 'VERIFIER_ERROR', error: String(error?.message ?? error) };
    }
  }

  // A successful return proves execution, not correctness. Without an explicit
  // verifier we therefore refuse to manufacture a positive learning signal.
  return {
    outcome: VERIFICATION_OUTCOMES.INCONCLUSIVE,
    confidence: .25,
    reason: expected == null ? 'EXECUTION_ONLY' : 'NO_CAPABILITY_VERIFIER',
  };
}

export function summarizeVerification(results = []) {
  const verified = results.filter(r => r.verification?.outcome === VERIFICATION_OUTCOMES.VERIFIED).length;
  const failed = results.filter(r => r.verification?.outcome === VERIFICATION_OUTCOMES.FAILED).length;
  const inconclusive = results.length - verified - failed;
  const outcome = failed ? VERIFICATION_OUTCOMES.FAILED : verified === results.length && results.length ? VERIFICATION_OUTCOMES.VERIFIED : VERIFICATION_OUTCOMES.INCONCLUSIVE;
  return { outcome, verified, failed, inconclusive, confidence: results.length ? verified / results.length : 0 };
}
