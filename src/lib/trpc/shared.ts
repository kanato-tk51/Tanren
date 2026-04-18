import { appUrl } from "@/lib/env";

export function getTrpcUrl(): string {
  return `${appUrl}/api/trpc`;
}
