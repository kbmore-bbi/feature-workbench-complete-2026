'use client';

import { SttmBuilderProvider } from '@/features/sttm/context/sttm-builder-context';

export default function SttmLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div>
            <SttmBuilderProvider>{children}</SttmBuilderProvider>
        </div>
    );
}