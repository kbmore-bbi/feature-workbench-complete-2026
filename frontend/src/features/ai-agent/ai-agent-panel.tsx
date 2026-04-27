'use client';

import React, { useState } from 'react';
import {
  Avatar,
  Box,
  IconButton,
  InputBase,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SendIcon from '@mui/icons-material/Send';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import TableChartIcon from '@mui/icons-material/TableChart';

import { useSttmBuilderContext } from '@/features/sttm/context/sttm-builder-context';

export default function AIAgentPanel() {
  const [draft, setDraft] = useState('');
  const { chatMessages, chatLoading, mappingCount, selectedSourceCount, sendChatMessage } =
    useSttmBuilderContext();

  return (
    <Paper
      elevation={0}
      sx={{
        width: '100%',
        height: '100%',
        minHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        border: '1px solid #e0e0e0',
        overflow: 'hidden',
        backgroundColor: '#f9f9f9',
      }}
    >
      <Box sx={{ p: 2, backgroundColor: '#000', color: '#fff' }}>
        <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Stack sx={{ flexDirection: 'row', gap: 1.5, alignItems: 'center' }}>
            <Avatar sx={{ bgcolor: '#333', width: 32, height: 32 }}>
              <SmartToyIcon sx={{ fontSize: 20 }} />
            </Avatar>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2, color: 'white' }}>
                STTM AI Agent
              </Typography>
              <Typography variant="caption" sx={{ color: '#888', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#4caf50' }} />
                Active · Cortex
              </Typography>
            </Box>
          </Stack>
          <IconButton size="small" sx={{ color: '#888' }}>
            <VolumeUpIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Box
          sx={{
            mt: 2,
            p: 1,
            borderRadius: '8px',
            backgroundColor: '#1a1a1a',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <TableChartIcon sx={{ fontSize: 16, color: '#888' }} />
          <Typography variant="caption" sx={{ color: '#888' }}>
            {selectedSourceCount} source tables · {mappingCount} mapped targets
          </Typography>
        </Box>
      </Box>

      <Box sx={{ p: 2, flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {chatMessages.map((message, index) => (
          <Stack
            key={`${message.role}-${index}`}
            direction="row"
            spacing={1.5}
            sx={{ justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start' }}
          >
            {message.role === 'assistant' && (
              <Avatar sx={{ bgcolor: '#000', width: 28, height: 28 }}>
                <SmartToyIcon sx={{ fontSize: 16 }} />
              </Avatar>
            )}
            <Paper
              elevation={0}
              sx={{
                p: 1.5,
                borderRadius: message.role === 'assistant' ? '0 12px 12px 12px' : '12px 0 12px 12px',
                border: '1px solid #e0e0e0',
                maxWidth: '85%',
                backgroundColor: '#fff',
              }}
            >
              <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
                {message.content}
              </Typography>
            </Paper>
          </Stack>
        ))}
      </Box>

      <Box sx={{ p: 1, backgroundColor: '#fff', borderTop: '1px solid #e0e0e0' }}>
        <Paper
          elevation={0}
          sx={{
            p: '2px 12px',
            display: 'flex',
            alignItems: 'center',
            borderRadius: '16px',
            backgroundColor: '#f9f9f9',
            border: '1px solid #e0e0e0',
            height: '36px',
          }}
        >
          <InputBase
            sx={{
              ml: 1,
              flex: 1,
              fontSize: '0.75rem',
              '& .MuiInputBase-input::placeholder': { opacity: 0.6 },
            }}
            value={draft}
            placeholder="Ask STTM AI..."
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (!chatLoading) {
                  const nextMessage = draft;
                  setDraft('');
                  void sendChatMessage(nextMessage);
                }
              }
            }}
          />
          <IconButton
            size="small"
            disabled={chatLoading || !draft.trim()}
            sx={{
              p: '2px',
              color: 'red',
              '&:hover': { backgroundColor: 'transparent' },
            }}
            onClick={() => {
              const nextMessage = draft;
              setDraft('');
              void sendChatMessage(nextMessage);
            }}
          >
            <SendIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Paper>
      </Box>
    </Paper>
  );
}
