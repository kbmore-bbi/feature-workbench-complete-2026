'use client';

import React from 'react';
// import SttmHeader from './components/SttmHeader';
// import SttmSidebar from './components/SttmSidebar';
// import SttmRightPanel from './components/SttmRightPanel';

export default function SttmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* HEADER */}
      <header style={{ flexShrink: 0 }}>
        {/* <SttmHeader /> */}
      </header>

      {/* BODY */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* LEFT SIDEBAR */}
        <aside style={{ width: 280, flexShrink: 0 }}>
          {/* <SttmSidebar /> */}
        </aside>

        {/* MAIN CONTENT */}
        <main style={{ flex: 1, overflow: 'auto' }}>
          {children}
        </main>

        {/* RIGHT PANEL (optional but matches your image) */}
        <aside style={{ width: 320, flexShrink: 0 }}>
          {/* <SttmRightPanel /> */}
        </aside>
      </div>
    </div>
  );
}