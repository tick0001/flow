import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Fusionne des classes Tailwind en resolvant les conflits. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
