'use client';
import {useState} from 'react'
import Button from '@mui/material/Button';
import SourceTree from '../../../components/SourceTree';

import SourceDialog from '../../../components/SourceDialog';
import SttmLayout from '../../../components/sttm-components/SttmLayout';


export default function Page() {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const toggleDialog = () => {
        setIsDialogOpen(!isDialogOpen);
    };

    return (
        <div style={{ padding: '20px' }}>
            {/* <Button variant="outlined" onClick={toggleDialog}>
                Open Child Dialog
            </Button>

            <SourceDialog open={isDialogOpen} handleClose={toggleDialog} />
            <SourceTree /> */}

            <SttmLayout />
        </div>
    );
}