gcloud builds submit --tag gcr.io/savvy-girder-270309/littb-snapshot && \
gcloud run deploy littb-snapshot --image gcr.io/savvy-girder-270309/littb-snapshot --platform managed