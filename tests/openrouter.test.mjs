import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { pickFreeModels, looksFree, FREE_ROUTER, OPENROUTER_BASE } = require("../api/_openrouter.js");

const model = (id, prompt, completion, extra = {}) => ({
  id,
  name: `${id} (free)`,
  context_length: 128000,
  pricing: { prompt, completion },
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["tools"],
  ...extra,
});

test("hanya model dengan harga prompt dan completion 0 yang masuk daftar", () => {
  const list = pickFreeModels({
    data: [
      model("a/gratis:free", "0", "0"),
      model("b/berbayar", "0.000001", "0.000002"),
      model("c/setengah", "0", "0.000002"),
    ],
  });
  assert.deepEqual(list.map((m) => m.id), ["a/gratis:free"]);
});

test("model gratis yang tidak menghasilkan teks (mis. musik) dibuang", () => {
  const list = pickFreeModels({
    data: [model("g/musik", "0", "0", { architecture: { input_modalities: ["text"], output_modalities: ["audio"] } })],
  });
  assert.equal(list.length, 0);
});

test("openrouter/free selalu paling atas, lalu model yang mendukung tools", () => {
  const list = pickFreeModels({
    data: [
      model("z/tanpa-tools:free", "0", "0", { supported_parameters: [] }),
      model("y/pakai-tools:free", "0", "0"),
      model(FREE_ROUTER, "0", "0"),
    ],
  });
  assert.deepEqual(list.map((m) => m.id), [FREE_ROUTER, "y/pakai-tools:free", "z/tanpa-tools:free"]);
  assert.equal(list[2].tools, false);
});

test("pola cadangan: hanya openrouter/free atau id berakhiran :free yang dianggap gratis", () => {
  assert.equal(looksFree("openrouter/free"), true);
  assert.equal(looksFree("google/gemma-4-31b-it:free"), true);
  assert.equal(looksFree("openai/gpt-5"), false);
  assert.equal(looksFree("openrouter/auto"), false);
  assert.equal(looksFree(""), false);
});

test("endpoint default adalah OpenRouter", () => {
  assert.equal(OPENROUTER_BASE, "https://openrouter.ai/api/v1");
});
