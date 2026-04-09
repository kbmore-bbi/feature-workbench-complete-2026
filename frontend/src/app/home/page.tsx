'use client';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';


export default function Page() {
    return (
        <>
            <h1>Home screen</h1>
            <Stack spacing={2} direction="row">
                <Button variant="text">Text</Button>
                <Button variant="contained" color="primary">Contained</Button>
                <Button variant="outlined">Outlined</Button>
            </Stack>
            <br /><br />
            <Stack direction="row" spacing={2}>
                <Button variant="outlined">Primary</Button>
                <Button variant="outlined" disabled>
                    Disabled
                </Button>
                <Button variant="outlined" href="#outlined-buttons">
                    Link
                </Button>
            </Stack>
            <br /><br />

            <Stack direction="row" spacing={2}>
                <Button color="secondary">Secondary</Button>
                <Button variant="contained" color="success">
                    Success
                </Button>
                <Button variant="outlined" color="error">
                    Error
                </Button>
            </Stack>
        </>
    )
}