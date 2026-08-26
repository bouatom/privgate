import { redirect } from "next/navigation";

export default function JitRedirect() {
  redirect("/elevations?tab=jit");
}
