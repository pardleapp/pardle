import { redirect } from "next/navigation";

/**
 * /commentary was the previous home for the analytical articles index;
 * it's been renamed to Insights and promoted to the homepage at /.
 * This redirect keeps any old inbound links working. Individual
 * articles still live at /commentary/[slug] so their URLs are stable.
 */
export default function CommentaryRedirect() {
  redirect("/");
}
