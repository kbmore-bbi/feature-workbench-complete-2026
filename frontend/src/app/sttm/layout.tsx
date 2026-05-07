'use client';

import { SttmBuilderProvider } from '@/features/sttm/context/sttm-builder-context';
import ChatWidget from '@/features/ai-agent/chat-widget';

export default function SttmLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div>
            <SttmBuilderProvider>
                {children}
                <ChatWidget />
            </SttmBuilderProvider>
        </div>
    );
}
