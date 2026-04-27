export function computeLineDiff(before: string, after: string): string[] {
  const linesA = before.split("\n");
  const linesB = after.split("\n");

  if (before === "" && after === "") return [];
  if (before === "") return linesB.map((l) => `+${l}`);
  if (after === "") return linesA.map((l) => `-${l}`);

  const dp: number[][] = Array.from({ length: linesA.length + 1 }, () =>
    Array(linesB.length + 1).fill(0),
  );

  for (let i = 1; i <= linesA.length; i++) {
    for (let j = 1; j <= linesB.length; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: string[] = [];
  let i = linesA.length;
  let j = linesB.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      result.push(` ${linesA[i - 1]}`);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push(`+${linesB[j - 1]}`);
      j--;
    } else {
      result.push(`-${linesA[i - 1]}`);
      i--;
    }
  }

  return result.reverse();
}
