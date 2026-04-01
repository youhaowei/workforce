/**
 * Maps lifecycle state to Badge variant + color props.
 * Spread into Badge: `<Badge {...stateVariant(state)}>`.
 */
export function stateVariant(state: string): {
  variant?: "solid" | "soft" | "outline";
  color?: "primary" | "success" | "danger" | "warning";
} {
  switch (state) {
    case "active":
      return { color: "primary" };
    case "paused":
      return { variant: "soft" };
    case "failed":
      return { color: "danger" };
    case "completed":
      return { variant: "outline" };
    case "cancelled":
      return { variant: "outline" };
    default:
      return { variant: "outline" };
  }
}
