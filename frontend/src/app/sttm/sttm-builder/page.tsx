import SourceTargetAttributeList from "@/components/sttm-builder/SourceTargetAttributeList";
import SourceTargetAttributeMapping from "@/components/sttm-builder/SourceTargetAttributeMapping";


export default function SttmBuilderPage() {   
    return (
       <>
       <div style={{display: 'flex'}}>
            <div style={{width: '20%'}}>
<SourceTargetAttributeList />
            </div>
            <div style={{width: '80%'}}>
<SourceTargetAttributeMapping />
            </div>
       </div>
        
        
       </>
    );
}