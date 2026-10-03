import test from "node:test";
import assert from "node:assert/strict";
import { canCreateReport } from "./report-state.mjs";

test("laporan menunggu menyembunyikan form baru", () => {
  assert.equal(canCreateReport({ quota: { canSend: false }, reports: [{ status: "open" }] }), false);
});
test("laporan diproses menyembunyikan form baru meskipun kuota lama masih mengizinkan", () => {
  assert.equal(canCreateReport({ quota: { canSend: true }, reports: [{ status: "in_progress" }] }), false);
});
test("laporan selesai mengizinkan kirim kembali", () => {
  assert.equal(canCreateReport({ quota: { canSend: true }, reports: [{ status: "resolved" }] }), true);
});
test("laporan ditutup mengizinkan kirim kembali", () => {
  assert.equal(canCreateReport({ quota: { canSend: true }, reports: [{ status: "closed" }] }), true);
});
test("belum ada laporan mengizinkan kirim pertama setelah status diketahui", () => {
  assert.equal(canCreateReport({ quota: { canSend: true }, reports: [] }), true);
  assert.equal(canCreateReport(null), false);
});
