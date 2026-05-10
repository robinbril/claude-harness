# Karpathy Method (always active)

Applies to EVERY coding request. No exceptions.

## 1. Think Before Coding

Before writing any code:
- State assumptions explicitly. If uncertain, ask.
- Multiple interpretations? Present them, don't pick silently.
- Simpler approach exists? Say so. Push back when warranted.
- Something unclear? Stop. Name it. Ask.

## 2. Surgical Changes

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor what isn't broken. Match existing style.
- Unrelated dead code? Mention it, don't delete it.
- Remove only imports/variables/functions YOUR changes made unused.
- Every changed line must trace directly to the request.

## 3. Goal-Driven Execution

Transform every task into verifiable steps:
```
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
```

"Add validation" becomes "write tests for invalid inputs, then make them pass."
"Fix the bug" becomes "write a test that reproduces it, then make it pass."

Loop until verified. Weak criteria ("make it work") require clarification first.

## 4. Minimum Code

No features beyond what was asked. No abstractions for single-use code. No speculative "flexibility." If 200 lines could be 50, rewrite it.

Ask: "Would a senior engineer call this overcomplicated?" If yes, simplify.
