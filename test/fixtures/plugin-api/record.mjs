// The recorder of a fixture export. Each call of the export is recorded with its arguments; the test arranges the answer of each
// method, and a method that the test did not arrange refuses the call, so an unexpected use of the interface fails the test.

/** Methods that the page calls for their effect, whose answer is undefined unless the test arranges another. */
export function createRecorder(name, { effects = [] } = {}) {
  const calls = [];
  const answers = new Map();
  for (const method of effects) answers.set(method, undefined);
  return {
    calls,
    /** Arranges the answer of a method: a value, or a function of the arguments that returns the value or throws. */
    arrange(method, answer) {
      answers.set(method, answer);
    },
    /** Records one call and returns its arranged answer; a method with no arranged answer refuses the call. */
    answer(method, args) {
      calls.push({ method, args });
      if (!answers.has(method)) throw new Error(`plugin API fixture ${name}: ${method} is not arranged by the test`);
      const arranged = answers.get(method);
      return typeof arranged === "function" ? arranged(...args) : arranged;
    },
    /** Records one call whose answer is optional: the arranged answer when there is one, otherwise undefined. */
    record(method, args) {
      calls.push({ method, args });
      const arranged = answers.get(method);
      return typeof arranged === "function" ? arranged(...args) : arranged;
    },
    /** Clears the calls and the arranged answers. */
    reset() {
      calls.length = 0;
      answers.clear();
      for (const method of effects) answers.set(method, undefined);
    },
  };
}
