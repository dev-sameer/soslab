import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileArchive, AlertCircle } from 'lucide-react';
import axios from 'axios';

function FileUploader({ onUploadComplete }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);

  const onDrop = useCallback(async (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setProgress(percentCompleted);
        },
      });

      onUploadComplete(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload failed');
      setUploading(false);
    }
  }, [onUploadComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    disabled: uploading,
    // SOLUTION: Use MIME types and single extensions only - NOT compound extensions
    accept: {
      'application/gzip': ['.gz'],           // This catches .tar.gz files
      'application/x-gzip': ['.gz'],         // Alternative MIME type for gzip
      'application/x-tar': ['.tar'],         // Plain tar files
      'application/x-compressed-tar': ['.tgz'], // Alternative extension
      'application/zip': ['.zip'],           // ZIP files
      'application/x-7z-compressed': ['.7z'], // 7zip
      'application/x-rar': ['.rar']          // RAR files
    },
    // Validator to ensure .tar.gz files are accepted even if browser is picky
    validator: (file) => {
      const fileName = file.name.toLowerCase();
      const validExtensions = ['.tar', '.tar.gz', '.tgz', '.gz', '.zip', '.7z', '.rar'];
      
      // Check if file ends with any valid extension
      const isValid = validExtensions.some(ext => fileName.endsWith(ext));
      
      if (!isValid) {
        return {
          code: 'invalid-file-type',
          message: `Please upload a valid archive file. Supported: ${validExtensions.join(', ')}`
        };
      }
      return null;
    }
  });

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div
        {...getRootProps()}
        className={`
          w-full max-w-3xl h-96 border-3 border-dashed rounded-xl
          flex flex-col items-center justify-center cursor-pointer
          transition-all duration-300 relative overflow-hidden
          ${isDragActive 
            ? 'border-blue-500 bg-blue-50 scale-105' 
            : 'border-gray-300 hover:border-gray-400 bg-white'
          }
          ${uploading ? 'cursor-not-allowed opacity-75' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        {uploading && (
          <div className="absolute inset-0 bg-blue-50 bg-opacity-90 flex flex-col items-center justify-center z-10">
            <div className="w-64 mb-4">
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <p className="text-lg font-medium text-gray-700">
              Uploading... {progress}%
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Processing SOS archive
            </p>
          </div>
        )}
        
        {!uploading && (
          <div className="text-center p-8">
            {isDragActive ? (
              <FileArchive className="w-20 h-20 mx-auto mb-4 text-blue-500" />
            ) : (
              <Upload className="w-20 h-20 mx-auto mb-4 text-gray-400" />
            )}
            
            <h3 className="text-xl font-semibold text-gray-700 mb-2">
              {isDragActive 
                ? 'Drop your SOS archive here' 
                : 'Drag & drop SOS archive'
              }
            </h3>
            
            <p className="text-gray-500 mb-4">
              or click to browse your files
            </p>
            
            <div className="flex flex-wrap justify-center gap-2 text-sm text-gray-400">
              <span className="px-2 py-1 bg-gray-100 rounded">.tar</span>
              <span className="px-2 py-1 bg-gray-100 rounded">.tar.gz / .gz</span>
              <span className="px-2 py-1 bg-gray-100 rounded">.tgz</span>
              <span className="px-2 py-1 bg-gray-100 rounded">.zip</span>
              <span className="px-2 py-1 bg-gray-100 rounded">.7z</span>
              <span className="px-2 py-1 bg-gray-100 rounded">.rar</span>
            </div>
            
            {/* Fallback: Manual file input if dropzone has issues */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className="text-xs text-gray-500 mb-2">Having trouble? Use manual upload:</p>
              <label className="inline-block">
                <input
                  type="file"
                  accept=".tar,.gz,.tgz,.zip,.7z,.rar,application/gzip,application/x-gzip,application/x-tar,application/zip"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      // Validate tar.gz files specifically
                      const fileName = file.name.toLowerCase();
                      if (fileName.endsWith('.tar.gz') || 
                          fileName.endsWith('.tgz') || 
                          fileName.endsWith('.gz') ||
                          fileName.endsWith('.tar') ||
                          fileName.endsWith('.zip') ||
                          fileName.endsWith('.7z') ||
                          fileName.endsWith('.rar')) {
                        onDrop([file]);
                      } else {
                        alert('Please select a valid archive file (.tar, .tar.gz, .tgz, .gz, .zip, .7z, .rar)');
                      }
                    }
                  }}
                  className="hidden"
                  disabled={uploading}
                />
                <span className="px-4 py-2 bg-blue-500 text-white rounded cursor-pointer hover:bg-blue-600 text-sm">
                  Select Archive File
                </span>
              </label>
              <p className="text-xs text-gray-400 mt-1">Supports: .tar, .tar.gz, .tgz, .gz, .zip, .7z, .rar</p>
            </div>
            
            {error && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-700">
                <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default FileUploader;