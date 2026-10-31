import { ExternalLink, FileText, Image as ImageIcon, Phone, Reply, Video } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PreviewButton {
  type: string;
  text?: string;
}

/** WhatsApp text formatting: *bold*, _italic_, ~strikethrough~ (rendered as elements, never HTML) */
export function WhatsAppText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*[^*]+\*$/.test(p)) return <strong key={i}>{p.slice(1, -1)}</strong>;
        if (/^_[^_]+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
        if (/^~[^~]+~$/.test(p)) return <s key={i}>{p.slice(1, -1)}</s>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

const MEDIA_ICON = { IMAGE: ImageIcon, VIDEO: Video, DOCUMENT: FileText } as const;

/** A phone-style chat bubble showing how a template / campaign message will look */
export function MessagePreview({
  headerFormat,
  headerText,
  mediaUrl,
  mediaName,
  body,
  footer,
  buttons = [],
  className,
}: {
  headerFormat?: string | null;
  headerText?: string | null;
  mediaUrl?: string | null;
  mediaName?: string | null;
  body: string;
  footer?: string | null;
  buttons?: PreviewButton[];
  className?: string;
}) {
  const MediaIcon = headerFormat && headerFormat in MEDIA_ICON ? MEDIA_ICON[headerFormat as keyof typeof MEDIA_ICON] : null;
  return (
    <div className={cn("rounded-xl bg-[#e5ddd5] p-3 dark:bg-[#0b141a]", className)}>
      <div className="max-w-[18rem] overflow-hidden rounded-lg rounded-tl-none bg-white text-sm text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
        {MediaIcon &&
          (mediaUrl && headerFormat === "IMAGE" ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of the user's own upload
            <img src={mediaUrl} alt="" className="aspect-video w-full object-cover" />
          ) : (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 bg-black/5 text-xs text-black/50 dark:bg-white/5 dark:text-white/50">
              <MediaIcon className="size-8" />
              {mediaName && <span className="max-w-[90%] truncate">{mediaName}</span>}
            </div>
          ))}
        <div className="grid gap-1 px-2.5 pt-2 pb-1.5">
          {headerText && <div className="font-bold break-words">{headerText}</div>}
          <div className="break-words whitespace-pre-wrap">
            {body ? <WhatsAppText text={body} /> : <span className="opacity-40">…</span>}
          </div>
          {footer && <div className="text-xs text-black/45 dark:text-white/45">{footer}</div>}
          <div className="text-end text-[10px] text-black/40 dark:text-white/40">12:00</div>
        </div>
        {buttons.map((b, i) => (
          <div key={i} className="flex items-center justify-center gap-1.5 border-t border-black/10 py-2 text-[13px] font-medium text-[#00a5f4] dark:border-white/10">
            {b.type === "URL" ? <ExternalLink className="size-3.5" /> : b.type === "PHONE_NUMBER" ? <Phone className="size-3.5" /> : <Reply className="size-3.5" />}
            {b.text || "…"}
          </div>
        ))}
      </div>
    </div>
  );
}

interface MetaComponent {
  type: string;
  format?: string;
  text?: string;
  buttons?: { type: string; text?: string }[];
}

/** Preview straight from Meta's component list */
export function TemplatePreview({ components, mediaUrl, mediaName, className }: { components: unknown; mediaUrl?: string | null; mediaName?: string | null; className?: string }) {
  const list = (Array.isArray(components) ? components : []) as MetaComponent[];
  const header = list.find((c) => c.type === "HEADER");
  return (
    <MessagePreview
      className={className}
      headerFormat={header?.format}
      headerText={header && (header.format ?? "TEXT") === "TEXT" ? header.text : null}
      mediaUrl={mediaUrl}
      mediaName={mediaName}
      body={list.find((c) => c.type === "BODY")?.text ?? ""}
      footer={list.find((c) => c.type === "FOOTER")?.text}
      buttons={list.find((c) => c.type === "BUTTONS")?.buttons ?? []}
    />
  );
}
