import { describe, expect, it } from "vitest";
import { pickReply } from "./reply-rotator";

describe("pickReply", () => {
	it("returns an empty string when there are no replies", () => {
		expect(pickReply([], 0)).toBe("");
		expect(pickReply([], 5)).toBe("");
	});

	it("always returns the only reply when there is one", () => {
		expect(pickReply(["only"], 0)).toBe("only");
		expect(pickReply(["only"], 99)).toBe("only");
	});

	it("rotates deterministically A,B,C,A,B,C by match count", () => {
		const replies = ["A", "B", "C"];
		expect([0, 1, 2, 3, 4, 5].map((c) => pickReply(replies, c))).toEqual([
			"A",
			"B",
			"C",
			"A",
			"B",
			"C",
		]);
	});

	it("guards against a negative match count", () => {
		expect(pickReply(["A", "B"], -3)).toBe("A");
	});
});
