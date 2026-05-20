"use client"; // Required for hooks in App Router


import React from 'react';
import { Box, Typography, Button, Grid, Paper, Stack, Container, IconButton } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import BoltIcon from '@mui/icons-material/Bolt';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import CloseIcon from '@mui/icons-material/Close';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import { useRouter } from 'next/navigation';
import Footer from '@/features/layout/app-footer';
import { CLIENT_CONFIG as config } from '@/config/client.config';

/* --- FEATURE CARD SUB-COMPONENT --- */
const FeatureCard = ({ icon, title }: { icon: any, title: string }) => (
  <Paper
    elevation={0}
    sx={{
      bgcolor: 'var(--aia-card-color)',
      borderRadius: '16px',
      width: '160px',
      height: '160px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 1.5
    }}
  >
    <Box sx={{ bgcolor: '#fff', p: 1, borderRadius: '50%', display: 'flex', border: '1px solid #ccc' }}>
      {React.cloneElement(icon, { sx: { fontSize: 24, color: '#000' } })}
    </Box>
    <Typography sx={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--aia-primary-text-color)', textAlign: 'center' }}>
      {title}
    </Typography>
  </Paper>
);

export default function HomePage() {
  const router = useRouter();
  return (
  <>
     {/* <AppHeader/> */}

    <Box sx={{ minHeight: '100vh', bgcolor: '#fff', position: 'relative', p: 4 }}>

      {/* 1. TOP HEADER (Welcome Message) */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 4 }}>
        <Box sx={{
          backgroundColor: 'var(--aia-card-color)', // Light gray background
          px: 2,
          py: 0.5,
          borderRadius: '20px',
          border: '1px solid #e2e8f0', // Optional light border
          display: 'flex',
          alignItems: 'center'
        }}>
          <Typography variant="caption" sx={{ color: 'var(--aia-primary-text-color)' }}>
            Welcome User!
          </Typography>
        </Box>
      </Box>

      <Container sx={{ mt: 8, maxWidth: '90% !important' }}>
        <Box sx={{
          display: 'flex',
          flexDirection: 'row !important',
          gap: 10, // Equivalent to spacing={10}
          width: '100%'
        }}>

          {/* LEFT COLUMN: Text Content */}
          <Grid
            sx={{
              // This replaces 'item' logic
              flexGrow: 0,
              // This replaces xs={12} and md={10}
              flexBasis: {
                xs: '100%',
                md: '83.33%'
              },
              // Your custom constraint
              maxWidth: '70% !important'
            }}
          >
            <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', mb: 2 }}>
              {config.app.clientTitle}
            </Typography>
            <Typography variant="h1" sx={{ fontWeight: 900, fontSize: '4rem', lineHeight: 1, mb: 3 }}>
              AI-Assisted <br /> Migration Workbench
            </Typography>
            <Typography sx={{ color: '#666', fontSize: '1.1rem', mb: 4, maxWidth: '500px' }}>
              STTM Builder brings clarity to complex data pipelines—making ETL documentation faster, collaborative, and always up to date.
            </Typography>

            <Stack spacing={1.5} sx={{ mb: 5 }}>
              {['Design.Document.Map', 'Define transformation logic', 'Collaborate in real-time'].map((text) => (
                <Stack
                  key={text}
                  sx={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 2 // gap: 2 is the sx equivalent of spacing={2}
                  }}
                >
                  <Box sx={{ width: 5, height: 5, bgcolor: '#000', borderRadius: '50%' }} />
                  <Typography sx={{ fontSize: '0.95rem', fontWeight: 500 }}>{text}</Typography>
                </Stack>
              ))}
            </Stack>

            <Button variant="contained"
              sx={{ bgcolor: 'var(--aia-button-color)', textTransform: 'none', px: 5, py: 1.5, borderRadius: '10px', fontWeight: 700 }}
              onClick={() => router.push('/dashboard')} >
              Get Started
            </Button>
          </Grid>

          {/* RIGHT COLUMN: Feature Cards */}
          <Grid
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'flex-start'
            }}
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'flex-start' }}>
              <FeatureCard icon={<VisibilityIcon />} title="STTM Viewer" />
              <FeatureCard icon={<AutoFixHighIcon />} title="STTM Builder" />
              <FeatureCard icon={<BoltIcon />} title="SQL Generation" />
            </Box>
          </Grid>
        </Box>
      </Container>

      {/* FLOATING AI WIDGET (Bottom Right) */}
      {/* <Box sx={{ position: 'fixed', bottom: 70, right: 24 }}>
        <Paper elevation={4} sx={{ bgcolor: '#000', color: '#fff', borderRadius: '12px', px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Stack
            sx={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 1
            }}
          >
            <SmartToyIcon sx={{ fontSize: 18 }} />
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>AI Assistant</Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <OpenInFullIcon sx={{ fontSize: 14, cursor: 'pointer' }} />
            <CloseIcon sx={{ fontSize: 14, cursor: 'pointer' }} />
          </Stack>
        </Paper>
      </Box> */}


      {/* FOOTER */}
        <Footer />
    </Box>
    </>   
  );
}
