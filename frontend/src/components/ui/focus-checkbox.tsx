'use client';
import Checkbox from '@mui/material/Checkbox';

const FocusCheckbox = (props: any) => {
    const uncheckedColor = props.uncheckedColor ?? 'black';
    const checkedColor = props.checkedColor ?? uncheckedColor;
    return (
        <Checkbox
            size="small"
            checked={props.checked}
            indeterminate={props.indeterminate}
            onChange={(e: any) => props.checkHandler(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            sx={{
                color: uncheckedColor,
                '&.Mui-checked': { color: checkedColor },
                p: 0.5, // Reducing internal padding of checkbox helps too
                ...(props.sx ?? {})
            }}
        />
    )
}

export { FocusCheckbox };