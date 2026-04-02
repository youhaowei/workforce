import { createLazyFileRoute } from "@tanstack/react-router";
import { OrgListView } from "../components/Org/OrgListView";

export const Route = createLazyFileRoute("/orgs")({
  component: OrgListView,
});
