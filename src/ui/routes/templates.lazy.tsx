import { createLazyFileRoute } from "@tanstack/react-router";
import { TemplateListView } from "../components/Templates";

export const Route = createLazyFileRoute("/templates")({
  component: TemplateListView,
});
