// apps/web/src/lib/utils.ts · shadcn-compatible cn helper (rename of cn.ts to match shadcn aliases)
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
