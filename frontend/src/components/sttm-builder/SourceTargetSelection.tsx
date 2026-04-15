type TablePanelProps = {
    title: string;
}
export default function SourceTargetSelection({title} : TablePanelProps) {
    return (
        <div style={{flex:1, minHeight:"400px", padding:"16px", border:"1px solid #ccc"}}>
            <h3>{title}</h3>
        </div>
    )  
}