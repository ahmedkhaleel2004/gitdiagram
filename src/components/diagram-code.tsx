import { Button } from "./ui/button"

const DiagramCode = ({ code }: { code: string | undefined }) => {
    const HandleCopy = () => {
        if (!code) return
        void navigator.clipboard.writeText(code)

    }
    return <div className="mt-8 mx-auto max-w-4xl rounded-lg bg-white/50 p-4 text-sm text-gray-600 w-full">
        <p className="font-medium text-purple-500 text-left">Diagram code:</p>
        <textarea
            id="mermaid-code"
            value={code}
            readOnly
            className="w-full mt-2 min-h-[200px] overflow-x-auto whitespace-pre-wrap leading-relaxed border border-purple-100 rounded-md p-3 font-mono bg-white/80 outline-none"
        />
        <Button onClick={HandleCopy} className="mt-4 w-full" >
            Copy diagram code
        </Button>
    </div>
}

export default DiagramCode