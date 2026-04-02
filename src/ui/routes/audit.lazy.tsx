import { createLazyFileRoute } from "@tanstack/react-router";
import { AuditView } from "../components/Audit";

export const Route = createLazyFileRoute("/audit")({
  component: AuditView,
});
