"use client";
import React from 'react';
import ViewerHeader from './viewer-header';

export default function SttmViewerLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="sttm-root">
            <ViewerHeader />
            <main className="sttm-view-content">
                {children}
            </main>
        </div>
    );
}