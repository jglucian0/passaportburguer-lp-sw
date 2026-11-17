"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  side?: "bottom" | "right";
  className?: string;
  children: ReactNode;
};

export function Sheet({ open, onOpenChange, title, side = "bottom", className, children }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/50 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "admin-light fixed z-50 flex flex-col border-slate-200 bg-white text-slate-900 shadow-2xl focus:outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
            side === "bottom" &&
              "inset-x-0 bottom-0 mx-auto max-h-[92dvh] w-full max-w-lg rounded-t-3xl border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            side === "right" &&
              "inset-y-0 right-0 h-dvh w-full max-w-md border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            className,
          )}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Close
            aria-label="Fechar"
            className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
          >
            <X className="h-5 w-5" />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
