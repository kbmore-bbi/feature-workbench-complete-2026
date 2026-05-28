'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { AppErrorPayload } from '@/api/errors/app-error';
import {
  dismissGlobalError,
  registerGlobalErrorListener,
} from '@/api/errors/error-bus';
import { GlobalErrorDialog } from './global-error-dialog';

export function GlobalErrorProvider({ children }: { children: ReactNode }) {
  const [currentError, setCurrentError] = useState<AppErrorPayload | null>(null);

  useEffect(() => {
    return registerGlobalErrorListener(setCurrentError);
  }, []);

  return (
    <>
      {children}
      <GlobalErrorDialog
        open={Boolean(currentError)}
        payload={currentError}
        onClose={dismissGlobalError}
      />
    </>
  );
}
