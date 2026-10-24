import React, { useRef, useState } from 'react';
import { Paperclip, FileText, X } from 'lucide-react';

export type ImageAttachment = {
 type: 'image';
 data: string;
 mimeType: string;
 name: string;
 url: string;
};

export type FileAttachment = {
 name: string;
 size: number;
 type?: string;
 data: string;
};

export async function processFiles(files: FileList | File[]): Promise<{ images: ImageAttachment[]; attachments: FileAttachment[] }> {
 const images: ImageAttachment[] = [];
 const attachments: FileAttachment[] = [];

 for (const file of Array.from(files)) {
  if (file.type.startsWith('image/')) {
   const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
   });
   const data = dataUrl.split(',')[1] || '';
   images.push({
    type: 'image',
    data,
    mimeType: file.type || 'image/png',
    name: file.name,
    url: dataUrl
   });
  } else {
   const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || '');
    reader.onerror = () => resolve('');
    reader.readAsText(file);
   });
   attachments.push({
    name: file.name,
    size: file.size,
    type: file.type,
    data: text.slice(0, 500000)
   });
  }
 }

 return { images, attachments };
}

export function useAttachmentState() {
 const [images, setImages] = useState<ImageAttachment[]>([]);
 const [attachments, setAttachments] = useState<FileAttachment[]>([]);

 const addFiles = (newImages: ImageAttachment[], newAttachments: FileAttachment[]) => {
  setImages(prev => [...prev, ...newImages]);
  setAttachments(prev => [...prev, ...newAttachments]);
 };

 const removeImage = (index: number) => {
  setImages(prev => prev.filter((_, i) => i !== index));
 };

 const removeAttachment = (index: number) => {
  setAttachments(prev => prev.filter((_, i) => i !== index));
 };

 const clear = () => {
  setImages([]);
  setAttachments([]);
 };

 const handlePaste = async (e: React.ClipboardEvent) => {
  const files = Array.from(e.clipboardData.files);
  if (files.length > 0) {
   e.preventDefault();
   const { images: newImgs, attachments: newAtts } = await processFiles(files);
   addFiles(newImgs, newAtts);
  }
 };

 const handleDrop = async (e: React.DragEvent) => {
  e.preventDefault();
  if (e.dataTransfer.files?.length) {
   const { images: newImgs, attachments: newAtts } = await processFiles(e.dataTransfer.files);
   addFiles(newImgs, newAtts);
  }
 };

 return {
  images,
  attachments,
  setImages,
  setAttachments,
  addFiles,
  removeImage,
  removeAttachment,
  clear,
  handlePaste,
  handleDrop
 };
}

export function AttachmentInput({
 images,
 attachments,
 onAdd,
 onRemoveImage,
 onRemoveAttachment,
 disabled = false
}: {
 images: ImageAttachment[];
 attachments: FileAttachment[];
 onAdd: (newImages: ImageAttachment[], newAttachments: FileAttachment[]) => void;
 onRemoveImage: (index: number) => void;
 onRemoveAttachment: (index: number) => void;
 disabled?: boolean;
}) {
 const fileInputRef = useRef<HTMLInputElement>(null);

 const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
  if (!e.target.files?.length) return;
  const { images: newImgs, attachments: newAtts } = await processFiles(e.target.files);
  onAdd(newImgs, newAtts);
  if (fileInputRef.current) fileInputRef.current.value = '';
 };

 return (
  <div className="attachment-controls">
   {(images.length > 0 || attachments.length > 0) && (
    <div className="attachment-previews">
     {images.map((img, i) => (
      <span key={i} className="attachment-chip">
       <img src={img.url} alt={img.name} className="thumb" />
       <span className="name" title={img.name}>{img.name}</span>
       <button type="button" onClick={() => onRemoveImage(i)} title="Remove image">
        <X size={13} />
       </button>
      </span>
     ))}
     {attachments.map((att, i) => (
      <span key={i} className="attachment-chip">
       <FileText size={14} />
       <span className="name" title={att.name}>{att.name}</span>
       <button type="button" onClick={() => onRemoveAttachment(i)} title="Remove file">
        <X size={13} />
       </button>
      </span>
     ))}
    </div>
   )}
   <input
    ref={fileInputRef}
    type="file"
    multiple
    style={{ display: 'none' }}
    onChange={onFileChange}
    disabled={disabled}
   />
   <button
    type="button"
    className="attach-btn"
    disabled={disabled}
    onClick={() => fileInputRef.current?.click()}
    title="Attach images or files (you can also paste or drop)"
   >
    <Paperclip size={14} />
    <span>Attach</span>
   </button>
  </div>
 );
}

export function MessageAttachments({
 images,
 attachments
}: {
 images?: any[];
 attachments?: any[];
}) {
 if (!images?.length && !attachments?.length) return null;

 return (
  <div className="chat-attachment-grid">
   {images?.map((img, i) => {
    const src = img.url || (img.data ? `data:${img.mimeType || 'image/png'};base64,${img.data}` : '');
    if (!src) return null;
    return (
     <img
      key={i}
      src={src}
      alt={img.name || 'Attached image'}
      className="chat-attachment-img"
      onClick={() => window.open(src, '_blank')}
      title="Click to view full size"
     />
    );
   })}
   {attachments?.map((att, i) => (
    <div key={i} className="chat-attachment-file" title={`${att.name} (${Math.round((att.size || 0) / 1024)} KB)`}>
     <FileText size={15} />
     <span>{att.name}</span>
    </div>
   ))}
  </div>
 );
}
