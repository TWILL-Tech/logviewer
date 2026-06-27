import { expect, test } from "bun:test";
import { parseCsv } from "./parse";

test("parses header + numeric rows", () => {
  const { names, columns, rowCount } = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
  expect(names).toEqual(["a", "b", "c"]);
  expect(rowCount).toBe(2);
  expect(Array.from(columns[0])).toEqual([1, 4]);
  expect(Array.from(columns[2])).toEqual([3, 6]);
});

test("handles CRLF and missing trailing newline", () => {
  const { rowCount, columns } = parseCsv("x,y\r\n1,10\r\n2,20");
  expect(rowCount).toBe(2);
  expect(Array.from(columns[1])).toEqual([10, 20]);
});

test("generates column names when no header", () => {
  const { names, rowCount } = parseCsv("1,2\n3,4\n");
  expect(names).toEqual(["col0", "col1"]);
  expect(rowCount).toBe(2);
});

test("non-numeric cells become NaN", () => {
  const { columns } = parseCsv("a,b\n1,\n2,x\n");
  expect(Number.isNaN(columns[1][0])).toBe(true);
  expect(Number.isNaN(columns[1][1])).toBe(true);
});

test("parses scientific notation and negatives", () => {
  const { columns } = parseCsv("v\n-1.5e-3\n2.0E2\n");
  expect(columns[0][0]).toBeCloseTo(-0.0015);
  expect(columns[0][1]).toBeCloseTo(200);
});
