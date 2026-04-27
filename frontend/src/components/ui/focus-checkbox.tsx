'use client';
import Checkbox from '@mui/material/Checkbox';

const FocusCheckbox = (props: any) => {
    return (
        <Checkbox
            size="small"
            checked={props.checked}
            onChange={(e: any) => props.checkHandler(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            sx={{
                color: 'black',
                '&.Mui-checked': { color: 'black' },
                p: 0.5 // Reducing internal padding of checkbox helps too
            }}
        />
    )
}

export { FocusCheckbox };