export function canCreateReport(data) {
  return Boolean(data?.quota?.canSend === true && !data.reports?.some((r) => ["open", "in_progress"].includes(r.status)));
}

export function displayTicket(ticket) {
  return String(ticket || "").replace(/^#/, "").replace(/^AI-/, "TKT-");
}
