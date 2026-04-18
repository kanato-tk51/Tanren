import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui 流の `cn()` ヘルパ。Tailwind クラスの競合を解決 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
