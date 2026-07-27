"use client";
import { AiaBox, AiaStack } from '@/components/ui';

import { AiaText } from '@/components/ui/aia-text';
import React from "react";


export default function Footer() {
    return (
        <AiaBox sx={{ position: 'absolute', bottom: 24, left: 32, right: 32, display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #eee', pt: 2 }}>
            <AiaText variant="caption" sx={{ color: '#999' }}>© 2026 Focus Financial Partner. ALL RIGHTS RESERVED.</AiaText>
            <AiaStack direction="row" spacing={4}>
                {['PRIVACY POLICY', 'TERMS OF SERVICE', 'CONTACT'].map(text => (
                    <AiaText key={text} variant="caption" sx={{ color: '#999', cursor: 'pointer' }}>{text}</AiaText>
                ))}
            </AiaStack>
        </AiaBox>
    );
}