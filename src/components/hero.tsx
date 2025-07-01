import React from "react";

const Hero = () => {
  return (
    <div className="relative mx-auto flex w-full flex-col items-start justify-center sm:flex-row sm:items-center">
      <svg
        className="left-0 h-auto w-16 flex-shrink-0 -translate-x-2 translate-y-4 p-2 sm:absolute sm:w-20 sm:-translate-y-16 md:relative md:w-24 md:-translate-y-0 md:translate-x-10 lg:absolute lg:ml-32 lg:-translate-x-full lg:-translate-y-10"
        viewBox="0 0 91 98"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="m35.878 14.162 1.333-5.369 1.933 5.183c4.47 11.982 14.036 21.085 25.828 24.467l5.42 1.555-5.209 2.16c-11.332 4.697-19.806 14.826-22.888 27.237l-1.333 5.369-1.933-5.183C34.56 57.599 24.993 48.496 13.201 45.114l-5.42-1.555 5.21-2.16c11.331-4.697 19.805-14.826 22.887-27.237Z"
          fill="#a855f7"
          stroke="#000"
          className="dark:stroke-white"
          strokeWidth="3.445"
        />
        <path
          d="M79.653 5.729c-2.436 5.323-9.515 15.25-18.341 12.374m9.197 16.336c2.6-5.851 10.008-16.834 18.842-13.956m-9.738-15.07c-.374 3.787 1.076 12.078 9.869 14.943M70.61 34.6c.503-4.21-.69-13.346-9.49-16.214M14.922 65.967c1.338 5.677 6.372 16.756 15.808 15.659M18.21 95.832c-1.392-6.226-6.54-18.404-15.984-17.305m12.85-12.892c-.41 3.771-3.576 11.588-12.968 12.681M18.025 96c.367-4.21 3.453-12.905 12.854-14"
          stroke="#000"
          strokeWidth="2.548"
          strokeLinecap="round"
          className="dark:stroke-white"
        />
      </svg>
      <h1 className="relative inline-block w-full text-center text-5xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:pt-5 lg:text-7xl">
        Repository to <br />
        diagram&nbsp;
      </h1>
      <svg
        className="bottom-0 right-0 hidden h-auto w-16 flex-shrink-0 -translate-x-10 translate-y-10 md:block md:translate-y-20 lg:absolute lg:w-20 lg:-translate-x-12 lg:translate-y-4"
        viewBox="0 0 92 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="m35.213 16.953.595-5.261 2.644 4.587a35.056 35.056 0 0 0 26.432 17.33l5.261.594-4.587 2.644A35.056 35.056 0 0 0 48.23 63.28l-.595 5.26-2.644-4.587a35.056 35.056 0 0 0-26.432-17.328l-5.261-.595 4.587-2.644a35.056 35.056 0 0 0 17.329-26.433Z"
          fill="#38bdf8"
          stroke="#000"
          strokeWidth="2.868"
          className="dark:stroke-white"
        />
        <path
          d="M75.062 40.108c1.07 5.255 1.072 16.52-7.472 19.54m7.422-19.682c1.836 2.965 7.643 8.14 16.187 5.121-8.544 3.02-8.207 15.23-6.971 20.957-1.97-3.343-8.044-9.274-16.588-6.254M12.054 28.012c1.34-5.22 6.126-15.4 14.554-14.369M12.035 28.162c-.274-3.487-2.93-10.719-11.358-11.75C9.104 17.443 14.013 6.262 15.414.542c.226 3.888 2.784 11.92 11.212 12.95"
          stroke="#000"
          strokeWidth="2.319"
          strokeLinecap="round"
          className="dark:stroke-white"
        />
      </svg>
    </div>
  );
};

export default Hero;
