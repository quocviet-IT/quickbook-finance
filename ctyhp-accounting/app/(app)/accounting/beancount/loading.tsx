import { PageLoading } from "@/components/ui/PageStates";

/**
 * The Accounting overview's skeleton is the dashboard's shape; under it this
 * page would load behind a picture of a different screen. The plain one instead.
 */
export default function BeancountLoading() {
  return <PageLoading title="Loading the Beancount file" />;
}
