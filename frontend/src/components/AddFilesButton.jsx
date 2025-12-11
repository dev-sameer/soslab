// AddFilesButton.jsx - COMPLETE WORKING VERSION
import React, { useState, useRef } from 'react';
import { FilePlus, X } from 'lucide-react';

const AddFilesButton = ({ sessionId, onFilesAdded, compact = false }) => {
    const [showModal, setShowModal] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState({});
    const fileInputRef = useRef(null);

    const handleFiles = async (files) => {
        if (files.length === 0) return;
        
        console.log('📤 Starting upload of', files.length, 'files to session:', sessionId);
        setUploading(true);

        try {
            // Build form data
            const formData = new FormData();
            files.forEach(file => {
                formData.append('files', file);
                setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));
            });

            // Progress simulation
            const progressInterval = setInterval(() => {
                setUploadProgress(prev => {
                    const updated = { ...prev };
                    Object.keys(updated).forEach(key => {
                        if (updated[key] < 90) updated[key] += 15;
                    });
                    return updated;
                });
            }, 200);

            // 1. Upload the files
            console.log('📤 Calling add-files API...');
            const uploadResponse = await fetch(`/api/sessions/${sessionId}/add-files`, {
                method: 'POST',
                body: formData
            });

            clearInterval(progressInterval);

            if (!uploadResponse.ok) {
                throw new Error(`Upload failed: ${uploadResponse.status}`);
            }

            const uploadResult = await uploadResponse.json();
            console.log('✅ Upload result:', uploadResult);

            // Complete progress bars
            setUploadProgress(prev => {
                const updated = { ...prev };
                Object.keys(updated).forEach(key => updated[key] = 100);
                return updated;
            });

            // 2. CRITICAL: Fetch the updated analysis data
            console.log('📊 Fetching updated analysis...');
            const analysisResponse = await fetch(`/api/analysis/${sessionId}`);
            
            if (!analysisResponse.ok) {
                throw new Error(`Failed to fetch analysis: ${analysisResponse.status}`);
            }
            
            const updatedAnalysis = await analysisResponse.json();
            console.log('✅ Updated analysis:', updatedAnalysis);
            console.log('   Total files:', updatedAnalysis.total_files);
            console.log('   Log files:', Object.keys(updatedAnalysis.log_files || {}));

            // 3. CRITICAL: Call the callback with the updated analysis
            if (onFilesAdded) {
                console.log('📢 Calling onFilesAdded callback...');
                onFilesAdded(updatedAnalysis);
            }

            // Wait a moment to show success
            await new Promise(r => setTimeout(r, 500));

            // 4. Close modal
            setShowModal(false);
            setUploadProgress({});

        } catch (error) {
            console.error('❌ Upload error:', error);
            alert('Failed to upload files: ' + error.message);
        } finally {
            setUploading(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        handleFiles(files);
    };

    const handleFileInputChange = (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            handleFiles(files);
        }
    };

    return (
        <>
            {/* Trigger Button */}
            <button
                onClick={() => setShowModal(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg smooth-transition ${
                    compact ? 'text-xs' : 'text-sm'
                }`}
                style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-secondary)'
                }}
                title="Add files to this session"
            >
                <FilePlus className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
                {!compact && <span>Add Files</span>}
            </button>

            {/* Modal */}
            {showModal && (
                <div 
                    className="fixed inset-0 z-50 flex items-center justify-center"
                    style={{ background: 'rgba(0, 0, 0, 0.7)' }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !uploading) {
                            setShowModal(false);
                        }
                    }}
                >
                    <div
                        onDrop={handleDrop}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                        className="w-full max-w-lg m-4 p-8 rounded-2xl relative"
                        style={{
                            background: 'var(--bg-primary)',
                            border: isDragging ? '3px dashed var(--accent)' : '1px solid var(--border-primary)',
                            transform: isDragging ? 'scale(1.02)' : 'scale(1)',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        {/* Close button */}
                        {!uploading && (
                            <button
                                onClick={() => setShowModal(false)}
                                className="absolute top-4 right-4 p-2 rounded-lg"
                                style={{ background: 'var(--bg-tertiary)' }}
                            >
                                <X className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                            </button>
                        )}

                        {/* Hidden file input */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            onChange={handleFileInputChange}
                            className="hidden"
                            disabled={uploading}
                        />

                        {uploading ? (
                            /* Uploading state */
                            <div className="text-center">
                                <div 
                                    className="animate-spin w-12 h-12 border-4 border-t-transparent rounded-full mx-auto mb-4"
                                    style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} 
                                />
                                <p className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                                    Adding files to session...
                                </p>
                                <div className="space-y-2 max-h-40 overflow-y-auto">
                                    {Object.entries(uploadProgress).map(([filename, progress]) => (
                                        <div key={filename}>
                                            <div className="flex justify-between text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                                                <span className="truncate max-w-[300px]">{filename}</span>
                                                <span>{progress}%</span>
                                            </div>
                                            <div className="h-1.5 rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
                                                <div 
                                                    className="h-full rounded-full transition-all"
                                                    style={{ 
                                                        width: `${progress}%`,
                                                        background: progress === 100 ? '#10b981' : 'var(--accent)'
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            /* Upload interface */
                            <div className="text-center">
                                <FilePlus 
                                    className="w-16 h-16 mx-auto mb-4" 
                                    style={{ color: isDragging ? 'var(--accent)' : 'var(--text-tertiary)' }} 
                                />
                                
                                <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                    {isDragging ? 'Drop files here' : 'Add Files to Session'}
                                </h3>
                                
                                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                                    Drag & drop files or click to browse
                                </p>

                                <div className="flex flex-wrap justify-center gap-2 text-xs mb-4">
                                    {['.log', '.json', '.txt', '.tar.gz', '.zip'].map(ext => (
                                        <span 
                                            key={ext} 
                                            className="px-2 py-1 rounded-full" 
                                            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                                        >
                                            {ext}
                                        </span>
                                    ))}
                                </div>

                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="px-6 py-2 rounded-xl font-semibold"
                                    style={{
                                        background: 'var(--accent)',
                                        color: 'var(--bg-primary)'
                                    }}
                                >
                                    Browse Files
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default AddFilesButton;
