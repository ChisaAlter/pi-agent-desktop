// Button Component

import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * 视觉风格
   * - primary/secondary/danger/ghost: 原有变体(向后兼容,不变)
   * - outline: 边框 + 透明背景,hover 浅灰(用于次要操作,比 secondary 更轻)
   * - subtle:  无边框 + 透明背景,hover 浅灰(用于行内操作/状态条,替代
   *           PiStatusPanel 等场景的 `bg-gray-800 hover:bg-red-900/50` 这类
   *           "主题色"硬编码)
   */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'subtle';
  /**
   * 尺寸
   * - sm/md/lg: 原有尺寸(向后兼容,不变)
   * - xs:       紧凑按钮(px-2 py-1 text-xs),给表格行/工具条小按钮
   * - icon:     方形图标按钮(w-8 h-8 p-0),只放图标
   */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className = '',
  disabled,
  type = 'button',
  ...props
}: ButtonProps): React.JSX.Element {
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';
  
  const variantClasses = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500',
    secondary: 'bg-gray-600 text-white hover:bg-gray-700 focus-visible:ring-gray-500',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
    ghost: 'bg-transparent text-gray-300 hover:bg-gray-700 focus-visible:ring-gray-500',
    // 边框 + 透明背景 + hover 浅灰;适合次要操作(取消/返回)
    outline: 'bg-transparent text-gray-700 border border-gray-300 hover:bg-[var(--mm-bg-hover)] focus-visible:ring-gray-400',
    // 无边框 + 透明背景 + hover 浅灰;适合行内/低权重操作,替代硬编码主题色按钮
    subtle: 'bg-transparent text-gray-600 hover:bg-[var(--mm-bg-hover)] focus-visible:ring-gray-400'
  };
  
  const sizeClasses = {
    xs: 'px-2 py-1 text-xs',
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
    // 方形:用于仅含图标的按钮
    icon: 'w-8 h-8 p-0'
  };
  
  const disabledClasses = 'opacity-50 cursor-not-allowed';
  
  return (
    <button
      type={type}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${
        disabled || isLoading ? disabledClasses : ''
      } ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}